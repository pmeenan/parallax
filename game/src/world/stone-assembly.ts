import type { GreyboxDistrictSpec } from "./greybox-spec";
import { fitRigidStoneToCollision } from "./rigid-stone-terrain-fit";

export interface StoneAssemblyData {
  readonly assetId: string;
  readonly candidateSha256: string;
  readonly toneFactors: Readonly<Record<string, readonly [number, number, number]>>;
  readonly variants: Readonly<
    Record<
      string,
      Readonly<{
        bottomFootprint: readonly (readonly [number, number])[];
        burialDepth: number;
      }>
    >
  >;
  readonly placements: readonly Readonly<{
    id: string;
    variantId: string;
    center: readonly [number, number, number];
    yaw: number;
    pitch: number;
    roll: number;
    scale: number;
    tone: string;
  }>[];
}

/** The full courtyard reflects one authored scene, including its joint-aware grass.
 * Only the separate stone-only diagnostic is fitted to existing collision triangles.
 */
export function createStoneAssemblyPlacements(
  spec: GreyboxDistrictSpec,
  data: StoneAssemblyData,
  courtyard: readonly [number, number],
  slope: readonly [number, number],
  slopeCount: number,
) {
  const placements: NonNullable<GreyboxDistrictSpec["assetPlacements"]>[number][] = [];
  const support = [];
  for (const [index, source] of data.placements.entries()) {
    const factor = data.toneFactors[source.tone];
    const variant = data.variants[source.variantId];
    if (!factor || !variant) throw new Error("Stone assembly variant or tone is missing");
    const shared = {
      assetId: data.assetId,
      variantId: source.variantId,
      baseColorFactor: factor,
      scale: source.scale,
      rotationXRadians: source.pitch,
      rotationYRadians: -source.yaw,
      rotationZRadians: source.roll === 0 ? 0 : -source.roll,
      lodDistancesMeters: [12, 32] as const,
    };
    placements.push({
      ...shared,
      id: `courtyard-${source.id}`,
      center: [courtyard[0] - source.center[0], courtyard[1] + source.center[2]],
      heightAnchor: courtyard,
      heightOffset: source.center[1],
    });
    if (index >= slopeCount) continue;
    const fitted = fitRigidStoneToCollision(
      spec,
      {
        ...shared,
        position: [slope[0] - source.center[0], 0, slope[1] + source.center[2]],
        scale: [source.scale, source.scale, source.scale],
      },
      variant.bottomFootprint,
      variant.burialDepth,
    );
    placements.push({
      ...shared,
      id: `slope-${source.id}`,
      center: [fitted.transform.position[0], fitted.transform.position[2]],
      heightOffset: fitted.heightOffset,
      rotationXRadians: fitted.transform.rotationXRadians,
      rotationYRadians: fitted.transform.rotationYRadians,
      rotationZRadians: fitted.transform.rotationZRadians,
    });
    support.push({ id: `slope-${source.id}`, ...fitted });
  }
  for (const variantId of ["substrate", "grass"])
    placements.push({
      id: `courtyard-${variantId}`,
      assetId: data.assetId,
      variantId,
      center: courtyard,
      heightAnchor: courtyard,
      heightOffset: 0,
      rotationYRadians: 0,
      lodDistancesMeters: [12, 32],
    });
  return { placements, support };
}
