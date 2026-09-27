import type { Mesh } from "@babylonjs/lite";

/**
 * Babylon Lite 1.31.1 builds every thin-instance mesh added to a registered scene through a
 * full rebuild of its material family (`lib/scene/scene-runtime-mesh-build.js`, `B`): one
 * rebuild per mesh, chained, each covering every PBR renderable and re-creating the CSM caster
 * state. A streamed cell adds one pool per placement and LOD, so the K1 test house (hundreds of
 * pools) re-created about 340k buffers and 170k bind groups in one frame and stalled the render
 * worker for 9.6 s (docs/rough-edges.md, "Lite rebuilds the PBR family per runtime thin pool").
 *
 * Every streamed PBR pool has the feature set that the warmup mesh compiles into the PBR group
 * at scene registration: thin instances, received shadows and the single directional light. So
 * Lite's per-mesh path, the group's `rebuildSingle`, builds it correctly. Clearing the pool's
 * runtime-thin hook makes the material-swap drain take that path. When the group is not built,
 * the drain still falls back to Lite's full build.
 *
 * A runtime-guarded seam, like `lite-device-loss.ts` (D-104): it fails loudly if the pinned
 * Lite no longer installs the hook, so an upgrade re-checks this instead of silently regressing.
 */
export function buildThinPoolInBuiltGroup(mesh: Mesh): void {
  const candidate = mesh as unknown as { _runtimeThinBuild?: unknown };
  if (typeof candidate._runtimeThinBuild !== "function") {
    throw new Error(
      "Babylon Lite did not install its runtime thin-instance build hook; re-check lite-thin-pool-build.ts",
    );
  }
  delete candidate._runtimeThinBuild;
}
