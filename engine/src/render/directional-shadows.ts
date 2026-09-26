import {
  createCsmDirectionalShadowGenerator,
  type DirectionalLight,
  type EngineContext,
  type Mesh,
  type ShadowGenerator,
  setShadowTaskCasterMeshes,
} from "@babylonjs/lite";
import { installNormalOffsetCsmReceivers } from "./csm-normal-offset-receiver";

/** Retained M4.5 candidate. Logical depth-array bytes are not GPU residency. */
export const DIRECTIONAL_SHADOW_CONFIG = Object.freeze({
  cascadeBlendPercentage: 0.12,
  forceRefreshEveryFrame: true,
  // Fade at the outer cascade footprint: the pinned receiver otherwise samples
  // the last cascade beyond shadowMaxZ with clamp-to-edge addressing.
  frustumEdgeFalloff: 0.1,
  lambda: 0.7,
  mapSize: 1024,
  numCascades: 4,
  shadowMaxZ: 180,
  stabilizeCascades: true,
  // Caster offset in metres. With the 3-texel receiver normal offset (engine package 6), 0.06 m
  // removes the sunlit-wall striping that 0.12 m alone left; 0.03 m brought the acne back.
  worldSpaceBias: 0.06,
});

/** Meshes whose relief a micro-shadow height field carries instead (engine package 6). A weak set,
 * so evicted meshes leave it with their last reference. */
const csmNonCasters = new WeakSet<Mesh>();

export function excludeFromCsmCasters(mesh: Mesh): void {
  csmNonCasters.add(mesh);
}

const isCsmCaster = (mesh: Mesh, excluded: ReadonlySet<Mesh>) =>
  mesh.visible !== false && !excluded.has(mesh) && !csmNonCasters.has(mesh);

export function createDirectionalShadows(engine: EngineContext, sun: DirectionalLight) {
  const generator = createCsmDirectionalShadowGenerator(engine, sun, DIRECTIONAL_SHADOW_CONFIG);
  // Replaces the stock receivers the generator just registered (engine package 6).
  installNormalOffsetCsmReceivers();
  sun.shadowGenerator = generator;
  let casters: readonly Mesh[] = [];
  let membershipUpdates = 0;
  return {
    generator,
    /** Only allocate on membership changes; transforms and the sun update every frame. */
    synchronize(meshes: readonly Mesh[], excluded: ReadonlySet<Mesh>): void {
      let index = 0;
      let changed = false;
      for (const mesh of meshes) {
        if (!isCsmCaster(mesh, excluded)) continue;
        if (casters[index] !== mesh) changed = true;
        index += 1;
      }
      if (!changed && index === casters.length) return;
      casters = meshes.filter((mesh) => isCsmCaster(mesh, excluded));
      // Lite uses list identity to invalidate cascade tasks. Never mutate a retained list.
      setShadowTaskCasterMeshes(generator, casters);
      pruneRetiredCasterMaterials(generator, casters);
      membershipUpdates += 1;
    },
    snapshot() {
      return Object.freeze({
        casterCount: casters.length,
        depthArrayBytes: 4 * 1024 * 1024 * 4,
        membershipUpdates,
        retainedMaterialCount: shadowMaterialMaps(generator)?.views.size ?? 0,
        technique: "directional-csm-pcf5-normal-offset@2" as const,
      });
    },
  };
}

/** Lite 1.31.1 (as 1.12.0) removes evicted meshes from tasks but retains their material views/gens. */
export function pruneRetiredCasterMaterials(
  generator: ShadowGenerator,
  casters: readonly Mesh[],
): void {
  const maps = shadowMaterialMaps(generator);
  if (maps === null) return; // The initial shadow task has not been built yet.
  const live = new Set(casters.map((mesh) => mesh.material));
  for (const material of maps.views.keys()) if (!live.has(material)) maps.views.delete(material);
  for (const material of maps.gens.keys()) if (!live.has(material)) maps.gens.delete(material);
}

function shadowMaterialMaps(
  generator: ShadowGenerator,
): { views: Map<Mesh["material"], unknown>; gens: Map<Mesh["material"], unknown> } | null {
  const state: unknown = Reflect.get(generator, "_shadowTaskState");
  if (state == null) return null;
  if (typeof state !== "object") throw new Error("Pinned CSM task state changed shape");
  const views: unknown = Reflect.get(state, "_materialViews");
  const gens: unknown = Reflect.get(state, "_casterMatGens");
  if (!(views instanceof Map) || !(gens instanceof Map))
    throw new Error("Pinned CSM material caches changed shape");
  return { views, gens };
}
