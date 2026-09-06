import { describe, expect, it } from "vitest";
import { writePbrAssetMatrix } from "../../engine/src/world/pbr-asset-transform";
import { DISTRICT_1_GREYBOX_SPEC } from "../src/world/district-1.data";
import {
  fitRigidStoneToCollision,
  sampleStoneCollisionSurface,
} from "../src/world/rigid-stone-terrain-fit";

const footprint = [
  [-0.24, -0.12],
  [0.24, -0.12],
  [0.24, 0.12],
  [-0.24, 0.12],
] as const;
describe("rigid stone terrain fitting", () => {
  it("preserves a flat courtyard stone's shape, yaw, and authored burial", () => {
    const result = fitRigidStoneToCollision(
      DISTRICT_1_GREYBOX_SPEC,
      { position: [6, 0, 6], scale: [1, 1, 1], rotationYRadians: 0.7 },
      footprint,
      0.063,
    );
    expect(result.heightOffset).toBeCloseTo(-0.063, 12);
    expect(result.transform.rotationYRadians).toBeCloseTo(0.7, 12);
    expect(result.transform.rotationXRadians).toBeCloseTo(0, 12);
    expect(result.transform.rotationZRadians).toBeCloseTo(0, 12);
    for (const p of result.support) expect(p.clearance).toBeCloseTo(-0.063, 12);
  });
  it("aligns a rigid stone to actual collision triangles and measures all bottom corners", () => {
    const authored = {
      position: [198, 0, 198],
      scale: [1.03, 1.03, 1.03],
      rotationYRadians: 2.1,
    } as const;
    const result = fitRigidStoneToCollision(DISTRICT_1_GREYBOX_SPEC, authored, footprint, 0.063);
    const ground = sampleStoneCollisionSurface(DISTRICT_1_GREYBOX_SPEC, 198, 198);
    const matrix = new Float64Array(16);
    writePbrAssetMatrix(matrix, 0, result.transform);
    const norm = Math.hypot(ground.gradientX, 1, ground.gradientZ);
    expect((matrix[4] ?? Number.NaN) / 1.03).toBeCloseTo(-ground.gradientX / norm, 10);
    expect((matrix[5] ?? Number.NaN) / 1.03).toBeCloseTo(1 / norm, 10);
    expect((matrix[6] ?? Number.NaN) / 1.03).toBeCloseTo(-ground.gradientZ / norm, 10);
    expect(Math.abs(ground.gradientX) + Math.abs(ground.gradientZ)).toBeGreaterThan(0.02);
    for (const p of result.support) expect(p.clearance).toBeCloseTo(-0.063, 10);
    expect(
      Math.hypot(matrix[0] ?? Number.NaN, matrix[1] ?? Number.NaN, matrix[2] ?? Number.NaN),
    ).toBeCloseTo(1.03, 10);
  });
});
