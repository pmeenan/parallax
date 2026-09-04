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

Blender mesh, UV, texture, and compressed-export checks are not applicable to greybox
v1 because it contains no binary mesh or texture assets. Under D-182 they become
mandatory before M4.5's first representative binary assets enter the library, rather
than waiting for M5. The pipeline is planned, not implemented by this documentation.

## First representative art and animation (M4.5, planned)

Start from sunny/gloomy reference sheets and a small D1 modular kit. Apply the asset
class budgets, scale, UV/texel-density, material, provenance/rights, LOD, and compressed
export checks in `../AGENTS.md`; round-trip the accepted outputs through the actual
worker loader. Resolve P-004 storage before retaining the first binary library outputs.
For the NPC/enemy, include rig/export integrity and the selected locomotion, idle, and
combat clips, inspecting deformation and motion in the shipping scene. Introduce only
the class-specific checks needed by those assets; later content extends the gate.

Deterministic route captures and motion inspection establish visual consistency and
no-visible-pop evidence for this finished area. Human acceptance and structural QA are
both required; neither substitutes for the other. M5 extends coverage across D1.
Track accepted kit pieces/animations per work session and rework during the two-week
trial to expose pipeline bottlenecks before expanding content generation.

M4.5's selected spatial SFX/ambience also needs a provenance/rights and audio QA path
before library admission: validate decodable format, duration/channel metadata and
authored level/loop behavior, then audition the asset in the surface/underground scene.
Class-specific audio checks replace inapplicable mesh checks; M6 expands this first set.
