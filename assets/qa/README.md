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
worker loader. D-186 resolves P-004 storage for the first binary library outputs.
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

## D1 paving: periodic generated limestone and retained sources

The current generated limestone uses `source/d1-paving/periodic.py` and
`periodic-provenance.json`. See its source README for reproduction. The same geometry,
UV, mip and compression checks apply. Generated input/prompt hashes and reviewed
output terms replace the scan's CC0 assertion; admission rechecks the current source
provenance and requires approved rights metadata. Normal strength follows the export.
The admitted periodic candidate is
`d1-paving-periodic-2026-09-05/courseless-final/candidate` under results, with its
production receipt in `d1-paving-periodic-worker-2026-09-05`. Periodic exports
add connected boundary profiles, planar UV correspondence, and opposite-edge
position/normal comparisons across every LOD pairing. The current candidate has
129 samples per edge, zero measured height mismatch and 0.00000171-degree maximum
normal mismatch over 2,322 comparisons. Base-color, normal and ORM cyclic-gradient
statistics remain diagnostics, not substitutes for inspecting repeated textures.
All 18 runtime resources passed the production decoder with external networking
blocked before admission. Installed artistic evaluation remains separate.

The earlier finite baseline remains reconstructible with `clean.py` and
`clean-provenance.json`; its evidence is retained in
`d1-paving-clean-2026-09-05/cycle2-final`. Its successful structural gate did not
establish periodicity. The periodic material still uses a rigid planar module;
terrain-conforming per-stone placement is not implemented.

The commands below document the superseded scan candidate.

The accepted source is `source/d1-paving/`; the runtime class limits and rationale
are in `d1-paving.json`. The two-stage gate is deliberately specific to this module:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.1/blender.exe' --background --threads 8 --python-exit-code 1 --python assets/source/d1-paving/export.py -- --source harness/results/d1-paving-rework-2026-09-05/scan-final/d1-scanned-source.blend --input harness/results/d1-paving-rework-2026-09-05/scanned-input --output harness/results/d1-paving-integration-2026-09-05/export
node assets/qa/prepare-d1-paving.mjs harness/results/d1-paving-integration-2026-09-05/export harness/results/d1-paving-integration-2026-09-05/candidate
node assets/qa/admit-d1-paving.mjs harness/results/d1-paving-integration-2026-09-05/candidate <production-worker-receipt.json>
```

The exporter verifies all four original map hashes and Blender 5.1.2. Preparation
checks provenance identity and CC0 rights, metric bounds, finite attributes, unit
normals, indices, per-LOD triangle ceilings, complete stone UV coverage and consistent
UV winding, KTX2 dimensions/mip counts, and the engine's
`canonicalMeshoptLayoutErrors` validator. Meshopt vertices must decode byte-exactly;
triangle indices may rotate cyclically while preserving topology and winding.
Zero-area source leaf-tip triangles are removed before export. The solid-color grass
UV exception is explicit in the class budget.

Admission requires a receipt bound to the candidate manifest SHA-256 from the
production compressed worker, covering all 18 runtime resources. It then rechecks all
21 object hashes and lengths (including the three canonical GLBs), writes objects
without replacement, and publishes the checked-in library manifest. A conflicting
existing object fails closed. Library admission is structural and rights approval;
source-art approval does not automatically accept runtime lighting, LOD transitions,
seams or appearance. Those remain part of the actual game captures.

## Individual limestone variants

`prepare-d1-stone-variants.mjs` uses the separate `d1-stone-variants.json` class;
the preceding periodic tile limits are unchanged. Eight reusable closed stone
variants retain three LODs, plus separate substrate and rooted vegetation families.
The scene asset ceiling is 200 stones and 750,000 near-LOD stone triangles: the
accepted fracture silhouette can require 153 × 3,900 = 596,700 triangles before a
small slope diagnostic. Shared variants bound resident geometry. The 16 MiB encoded
set, 8 MiB per-resource limit and runtime performance budgets remain unchanged.

This mode checks welded closed stone topology, actual metric bounds, declared
generated-surface and procedural-detail UV reuse, original/generated input hashes, and root clearance
against transformed geometry footprints across all LODs. It does not claim periodic
tile seams or measured material properties. Generated surface output retains its
reviewed OpenAI lineage separately from original Apache-2.0 geometry. Admission
requires every runtime resource in this variable-size set to pass the production
worker receipt before the immutable library changes; installed visual acceptance
remains separate.
