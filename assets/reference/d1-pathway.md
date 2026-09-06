# D1 irregular limestone pathway prototype

Reference: the courtyard sunny/gloomy scene in `d1-courtyard.md`, refined by the
human-selected [Stone Pathway 02](https://polyhaven.com/a/stone_pathway_02).
Use its irregular footprints and open joints, with brighter warm limestone and
sparse grasses growing from genuine gaps. Do not copy the regular cobblestone grid
from the rejected paving comparison. Film-like material depth, worn asymmetric edges,
geometric shadows and natural scale are the target; acceptance is still pending.

Kit: metre-scaled, bottom-anchored stones 0.23–1.0 m across and 0.08–0.13 m thick,
embedded 0.04 m into sampled existing terrain; linear pale limestone colors; scattered
0.05–0.16 m broad-leaf grass clumps. A shared shader-deformed template supplies geometry.
Seeded placement rejects rotated-footprint overlaps and plants inside stone envelopes.
A 17×11 terrain-sampled soil grid sits 12 mm above the existing surface in the joints.
No source textures,
downloaded meshes, displacement images or external runtime resources are included.

Provenance: authored TypeScript descriptors and WGSL by Codex, deterministic seed
`0x51a7e002`; visual references only, no third-party asset bytes in the package.
The Poly Haven reference is user-provided; no downloaded material is redistributed.
Public artistic acceptance remains pending. Ordinary build structural QA applies to
the generated cell descriptor before content-addressed packaging (D-090).

Bounded brief: two implementation/capture/evaluation cycles, two hours initially,
with the explicit 60-minute correction extension recorded in `docs/plan.md` after
the GPU binding failure and first valid visual inspection.
Inspect walking-height close and oblique cameras, clear and overcast/grazing light,
and motion. Must fix flat/printed appearance, regular rows, detached/floating stones,
plants through stones, mismatched shadows, and obvious repetition. Record costs and
limitations; integrate the best supported candidate or defer with a specific reason.

Cycle 2 responds to the first Chrome capture: 90 stones replace 35 widely spaced slabs;
12 mm rotated-footprint separation reduces gaps, thickness is lower, and the 110 tufts
are shorter with broader curved blades and lighter muted-green reflectance. The soil
grid removes neon-greybox grass between stones. These are candidates, not accepted art.

Final evaluation retains the compact geometry mechanism but defers the synthetic-only
finish: the surfaces and vegetation remain visibly manufactured. Scan-derived detail
and improved contact lighting are required for the next art pass. Runtime captures,
streaming checks and measured limits are in the
[prototype report](../../harness/results/d1-pathway-2026-09-05/summary.md).

The human subsequently rejected this runtime prototype as markedly worse than the
earlier scanned comparison. The active source-art correction now uses actual
`stone_pathway_02` displacement and matching material maps in Blender, rather than
another hand-coded slab approximation. See the
[source model](../source/d1-paving/README.md). This does not retroactively accept the
shader prototype or claim that the new source is already integrated into the game.

