import type { StreamingDependencyIndexEntry } from "../streaming/streaming-protocol";
import type { WorldBounds, WorldVec3 } from "./world-contract";

export interface PbrAssetMaterial {
  /** Omitted legacy/finite surfaces clamp; periodic assets opt in explicitly. */
  readonly textureAddressMode?: "clamp-to-edge" | "repeat";
  readonly baseColorResourceId: string;
  readonly normalResourceId: string;
  readonly ormResourceId: string;
  readonly baseColorFactor: WorldVec3;
  readonly roughnessFactor: number;
  readonly metallicFactor: number;
  readonly normalScale: number;
}

export interface PbrAssetLod {
  readonly vertexResourceId: string;
  readonly indexResourceId: string;
}

export interface PbrAssetPlacement {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly position: WorldVec3;
  readonly rotationYRadians: number;
  readonly rotationXRadians?: number;
  readonly rotationZRadians?: number;
  readonly scale: WorldVec3;
  readonly material: PbrAssetMaterial;
  readonly lodDistancesMeters: readonly [number, number];
  readonly lods: readonly [PbrAssetLod, PbrAssetLod, PbrAssetLod];
}

const ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string): void {
  if (Object.keys(value).sort().join(",") !== expected)
    throw new Error("PBR asset keys are invalid");
}
function vec3(value: unknown): value is WorldVec3 {
  return Array.isArray(value) && value.length === 3 && value.every(finite);
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function id(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

/** Cell-owned metadata; decoded streams remain owned by the existing dependency cache. */
export function validatePbrAssetPlacements(
  input: unknown,
  bounds?: WorldBounds,
  resources?: readonly StreamingDependencyIndexEntry[],
): asserts input is readonly PbrAssetPlacement[] {
  if (!Array.isArray(input) || input.length > 256) throw new Error("PBR asset count is invalid");
  const ids = new Set<string>();
  const byId =
    resources === undefined ? undefined : new Map(resources.map((r) => [r.resourceId, r]));
  for (const asset of input) {
    if (!record(asset)) throw new Error("PBR asset must be an object");
    keys(
      asset,
      `id,lodDistancesMeters,lods,material,position,${"rotationXRadians" in asset ? "rotationXRadians," : ""}rotationYRadians,${"rotationZRadians" in asset ? "rotationZRadians," : ""}scale,schemaVersion`,
    );
    if (
      !Array.isArray(asset.lodDistancesMeters) ||
      asset.lodDistancesMeters.length !== 2 ||
      !finite(asset.lodDistancesMeters[0]) ||
      !finite(asset.lodDistancesMeters[1]) ||
      asset.lodDistancesMeters[0] <= 0 ||
      asset.lodDistancesMeters[1] <= asset.lodDistancesMeters[0]
    )
      throw new Error("PBR asset LOD distances must increase");
    if (asset.schemaVersion !== 1 || !id(asset.id) || ids.has(asset.id))
      throw new Error("PBR asset identity is invalid");
    ids.add(asset.id);
    if (
      !vec3(asset.position) ||
      !vec3(asset.scale) ||
      asset.scale.some((v) => v <= 0 || v > 100) ||
      !finite(asset.rotationYRadians) ||
      ("rotationXRadians" in asset && !finite(asset.rotationXRadians)) ||
      ("rotationZRadians" in asset && !finite(asset.rotationZRadians))
    )
      throw new Error("PBR asset transform is invalid");
    if (
      bounds &&
      asset.position.some((v, i) => v < (bounds.minimum[i] ?? v) || v > (bounds.maximum[i] ?? v))
    )
      throw new Error("PBR asset origin is outside its cell");
    if (!record(asset.material)) throw new Error("PBR asset material is invalid");
    const material = asset.material;
    keys(
      material,
      `baseColorFactor,baseColorResourceId,metallicFactor,normalResourceId,normalScale,ormResourceId,roughnessFactor${"textureAddressMode" in material ? ",textureAddressMode" : ""}`,
    );
    if (
      "textureAddressMode" in material &&
      material.textureAddressMode !== "clamp-to-edge" &&
      material.textureAddressMode !== "repeat"
    )
      throw new Error("PBR asset texture address mode is invalid");
    if (
      !vec3(material.baseColorFactor) ||
      material.baseColorFactor.some((v) => v < 0 || v > 1) ||
      !finite(material.normalScale) ||
      material.normalScale < 0 ||
      material.normalScale > 4 ||
      !finite(material.roughnessFactor) ||
      material.roughnessFactor < 0 ||
      material.roughnessFactor > 1 ||
      !finite(material.metallicFactor) ||
      material.metallicFactor < 0 ||
      material.metallicFactor > 1
    )
      throw new Error("PBR asset material factors are invalid");
    for (const role of ["baseColorResourceId", "normalResourceId", "ormResourceId"] as const) {
      const resourceId = material[role];
      if (!id(resourceId)) throw new Error("PBR asset texture identity is invalid");
      if (byId) {
        const texture = byId.get(resourceId);
        if (
          texture?.format !== "ktx2" ||
          texture.decode.colorSpace !== (role === "baseColorResourceId" ? "srgb" : "linear")
        )
          throw new Error(
            `PBR asset texture role is invalid: ${asset.id} ${role}=${resourceId}; expected ${role === "baseColorResourceId" ? "srgb" : "linear"}, received ${texture?.format === "ktx2" ? texture.decode.colorSpace : (texture?.format ?? "absent")}; cohort=${[...byId.keys()].join(",")}`,
          );
      }
    }
    if (!Array.isArray(asset.lods) || asset.lods.length !== 3)
      throw new Error("PBR asset requires three LODs");
    for (const lod of asset.lods) {
      if (!record(lod)) throw new Error("PBR asset LOD is invalid");
      keys(lod, "indexResourceId,vertexResourceId");
      if (!id(lod.indexResourceId) || !id(lod.vertexResourceId))
        throw new Error("PBR asset LOD identity is invalid");
      if (byId) {
        const vertex = byId.get(lod.vertexResourceId);
        const index = byId.get(lod.indexResourceId);
        if (
          vertex?.format !== "meshopt" ||
          !("version" in vertex.decode) ||
          vertex.decode.mode !== "ATTRIBUTES" ||
          index?.format !== "meshopt" ||
          !("version" in index.decode) ||
          index.decode.mode !== "TRIANGLES" ||
          index.decode.vertexCount !== vertex.decode.count ||
          vertex.dependencies[0] !== material.baseColorResourceId ||
          index.dependencies[0] !== material.baseColorResourceId ||
          index.dependencies[1] !== lod.vertexResourceId
        )
          throw new Error("PBR asset geometry binding is invalid");
      }
    }
  }
}
