import {
  createCsmDirectionalShadowGenerator,
  type DirectionalLight,
  type EngineContext,
  type Mesh,
  type ShadowGenerator,
  setShadowTaskCasterMeshes,
} from "@babylonjs/lite";

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
  worldSpaceBias: 0.12,
});

export function createDirectionalShadows(engine: EngineContext, sun: DirectionalLight) {
  const generator = createCsmDirectionalShadowGenerator(engine, sun, DIRECTIONAL_SHADOW_CONFIG);
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
        if (mesh.visible === false || excluded.has(mesh)) continue;
        if (casters[index] !== mesh) changed = true;
        index += 1;
      }
      if (!changed && index === casters.length) return;
      casters = meshes.filter((mesh) => mesh.visible !== false && !excluded.has(mesh));
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
        technique: "directional-csm-pcf5@1" as const,
      });
    },
  };
}

/** Lite 1.12.0 removes evicted meshes from tasks but retains their material views/gens.
 * Views are plain inherited material objects, not owners of GPU resources. Prune only
 * those two caches; the public caster-list update owns render-task removal/rebinding.
 */
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
