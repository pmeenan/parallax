# Asset QA

## D1 procedural greybox v1

D-090 treats the procedural descriptors as game-owned world data and the build-emitted,
content-addressed cell JSON as the greybox library/package output. The QA gate is:

1. `validateGreyboxDistrict()` checks schema, units, unique IDs, representation payloads,
   material references, three ordered non-increasing LOD tiers, collision heightfields,
   AABBs, neighbors, and finite geometry. `pnpm build` runs this shared validator before
   writing any package artifact.
2. `game/test/greybox-world.test.ts` checks descriptor-driven byte-stable generation,
   exact 256-cell coverage, seam-identical visual/collision terrain samples,
   scale/LOD/collision constants, inclusive spatial bounds, whole compound-feature LOD
   reduction, landmark identity at far LOD, required zones, and three distinct future
   D2 entrance contexts.
3. `harness/src/build-contract.test.ts` parses all 256 cell wrappers, verifies their
   index/hash/coordinate identity, reconstructs the district, and reruns the shared
   validator over the packaged bytes. The production packager iterates the complete
   district registry and rejects duplicate district IDs or artifact-scope collisions.
4. The physical-console smoke gate checks the render worker materializes the target-scale
   preview, exports its counts/timing, observes and persists lighting phase/intensity
   ranges, requires 35–<99.9% of a hashed canvas-only PNG to differ from the
   telemetry-derived clear color, and remains within the current harness budgets.
5. `engine/test/greybox-heightfield-geometry.test.ts` verifies that single-sided
   downward skirts cover fine-to-coarse boundaries and are omitted between equal-LOD
   interior neighbors, and that their winding uses the same front-face convention as the
   terrain surface.

The retained physical-console QA artifact is
`smoke-1-71ce33331758-dev-01-showcase-2026-07-24T21-55-57-222Z.json`: schema v27,
mandatory metric-set v12, six complete fresh/warm core runs, all three facets passed,
and all 24 blocking checks passed. Canvas coverage was 87.78% in every run with observed
lighting motion. The immediately preceding same-artifact RE-008 trace failure is retained
alongside it.

Blender mesh, UV, texture, and compressed-export checks are not applicable because v1
contains no binary mesh or texture assets. Those checks become mandatory when M5 replaces
the procedural descriptors with final-art library assets.
