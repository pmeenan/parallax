# Broad limestone family — 2026-09-22 result

**Subsequent human feedback (2026-09-22):** the earlier smaller slabs looked
better, "more like cobblestone." Return the active proof to the earlier small-stone
scale. This study remains diagnostic evidence; broad slabs are no longer the target.
The preference is for scale and character, not approval of a complete earlier patch.

The two-cycle source study improves physical detail scale and breaks the three
obvious enlarged mineral landmarks, but does not finish the paving proof. Retain
[candidate2](broad-family/candidate2/source.blend) as provisional source evidence.
It remains too densely patterned and visibly warped. The representative export
also fails source-to-bake visual fidelity in matched close views, despite an
excellent reduced-mesh-to-GLB roundtrip. No new asset is admitted or installed.

## Native comparison

Four newly constructed stones measure approximately 1.09 × 0.73, 0.77 × 0.73,
0.91 × 0.55 and 0.95 × 0.55 m, with object scale one. Geometry is constructed on
a 2 mm surface grid; individual source counts are 921,600 / 665,600 / 601,200 /
626,000 triangles. These are authoring sources, not the scene budget or game LODs.
The retained generated microstructure has a 0.45 m period independent of slab size.
The broad candidate's minimum conservative AABB separation is 4.038 mm. This is
not a triangle-level contact bound, and narrower than the previous layout control.

The first candidate's wholly procedural broad reflectance replaced the earlier
limestone with pale cloud-like surfaces. Both independent screens and lead reject
it. A prior technical preflight had quantized noise caused by very large
seed-derived shader coordinates; `candidate1-corrected` is the actual first
artistic candidate. The initial preflight is explicitly invalid evidence.

Candidate2 restores the correlated limestone material, applies independent
shared coordinate warps to its color/scalar/roughness inputs, and caps side batter
at 1–4 mm instead of increasing it with slab width. Both
[quality](quality-broad-family2.md) and [theme](theme-broad-family2.md) screens plus
lead actual inspection find warmer mineral identity and no confidently identified
identical large landmark between the four stones. They also find pervasive
marbling, flowing streaks, insufficient quiet wear regions, and residual dark
undercuts. This is variation derived from the earlier synthetic inputs, not four
unrelated quarry samples. Source relief is not newly matched to the shader warp;
the source's geometry and shader microstructure remain distinct artistic layers.

Actual views: [oblique](broad-family/candidate2/oblique.png),
[walking](broad-family/candidate2/walking.png),
[opposing light](broad-family/candidate2/opposing-light.png),
[reverse](broad-family/candidate2/reverse.png),
[grazing](broad-family/candidate2/grazing.png),
[gray geometry](broad-family/candidate2/gray.png), and
[unlit](broad-family/candidate2/unlit.png). The source sample reuses the earth
shader/height recipe, but lacks the accepted contact's embedded grit and complete
contour integration. It does not supersede that accepted source or vegetation.

## Early transfer exposed a separate defect

Representative A reduces to 3,900 triangles, one material and three embedded
textures. Base color and normal are 2048²; roughness is 1024². The uncompressed
[GLB](broad-family/transfer/a/limestone.glb) is 10,977,740 bytes, SHA-256
`e6513dd687bd38a5fa1556c00204275f5c443c95078f5b17534ed29fe0c701ef`.
It exceeds the 8 MiB resource limit. Its approximately 1.09 m width also exceeds
the current class's 0.8 m bounds; neither limit was changed for this study.

Focused byte/mesh checks pass: GLB header and embedded buffer, one scene/mesh/
material, standard PBR channels, closed manifold native reduced mesh, and finite
positions/UVs within 0–1. The 4,609 sampled source-to-reduced distances have
0.807 mm p95 and 2.628 mm maximum. These samples are not a full error bound or
UV validation. Bake time is 4.02 s; the initial representative transfer sequence
took 30.39 s locally. Source build/capture/save took 36.90 s. These are authoring
observations, not runtime measurements.

The initial oblique native-low/reimport comparison nearly agrees (mean loaded
RGB delta 8.09e-7), but does not establish source fidelity. Dedicated
[walking source](broad-family/transfer/a/walking-high.png) versus
[walking import](broad-family/transfer/a/walking-import.png) and
[grazing source](broad-family/transfer/a/grazing-high.png) versus
[grazing import](broad-family/transfer/a/grazing-import.png) show altered mineral
features and loss of detail, independently confirmed by the quality screen.
Walking source/low mean RGB delta is 0.05004 and grazing is 0.01153; reduced/import
deltas remain 8.22e-7 and 1.36e-6. These whole-image deltas are diagnostic, not
acceptance thresholds.

A color-only comparison retains a 0.05033 walking difference, so the disagreement
is not explained solely by lighting or normal maps. Two bounded technical controls
on the unchanged source do not resolve it: explicitly binding the source object
coordinates gives 0.05004 walking delta; evaluating color/roughness directly on the
reduced surface gives 0.04995. Their retained directories are
`broad-family/transfer-explicit-object/` and `broad-family/transfer-target-field/`.
These controls neither establish a Blender bug nor isolate the remaining cause.
Do not promote either export. The source-to-bake issue is distinct from the
passing reduced-to-import roundtrip and remains open.

## Disposition and next work

Stop this material method at the two artistic cycles. Following the human's
smaller-stone preference, resume from the earlier sources at their authored scale;
do not shrink these broad warped materials and call that a return to the earlier
appearance. Correct long joints and repeated markings within the smaller-piece
direction. Where additional source variation is needed, seek quieter mineral
structures without stronger domain warps; further warp strength is unsupported by
these results. Isolate this study's color-bake discrepancy with a simple
coordinate/color fixture before reusing its transfer method. Preserve the accepted
contact, lighting, leaf color and moss when integration resumes. The eight-variant
class ceiling remains unchanged; this feedback does not require eight new broad
sources. Layout correction, sufficient source variety, accepted vegetation
integration, LODs/compression, rights review, full QA and installed-game proof
remain open.

Reproduction uses separate Blender 5.2.1 processes: `broad-family/build.py`, then
`build2.py`, `transfer.py`, `transfer-views.py`, `transfer-color-diagnostic.py`,
and the two named technical-control scripts. Each retained output directory must
be absent for a new native capture; preserve these originals and redirect a replay
to a new location. `finalize.py` formats JSON and binds final evidence bytes after
capture. `file-inventory.json` verifies the retained files and source identities;
it excludes self hashes and ignored Blender backups. No binaries are changed by
finalization. The invalid preflight script is retained as a byte-exact snapshot.

## Verification at handoff

The final inventory verifies 110 retained files and 50 recorded native input,
output and script identities. Focused Biome checking passes for all 18 JSON files
in `broad-family/`; `git diff --check` also passes. The pinned Node 24.18.1 /
pnpm 11.12.0 `pnpm check` run passes the build, then stops on 117 lint errors:
114 formatting diagnostics and three SVG accessibility diagnostics, all outside
the new broad-family package. Earlier source evidence was not reformatted merely
to clear this gate.

A separate full unit run passes 219 files / 2,619 tests, with 79 tests skipped,
but two PSO qualification suites time out in their ten-second setup hooks. A
single-worker rerun of those two files passes 60 tests and fails 18 lifecycle
tests at the five-second timeout. The qualification file passes in that rerun;
the result-lifecycle file remains failing. No assertion failure was observed,
but the timeouts remain unresolved and the repository gate is not passing.
Both suites read the current repository identity; its cost was not successfully
isolated, so these failures are not attributed to a proven preexisting issue or
to this asset package. No test timeout, harness code or budget was changed.
Machine-local logs are retained under
`%TEMP%/parallax-paving-broad-20260922/` (`pnpm-check.log`,
`lint-diagnostics.json`, `unit-tests.log`, and `focused-tests.log`).

Physical smoke: deferred to M4.5 exit — native diagnostic renders, focused GLB
checks and source/transfer comparisons cover this source-only package.
All changes remain uncommitted.
