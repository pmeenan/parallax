# Joint vegetation refinement — 2026-09-22

Human feedback authorizes a new focused package: the patch needs varied broadleaf
weeds, grass, moss and seedlings, with better leaf color and fine relief. Preserve
candidate2 stone layout, material, soil and approved lighting. Long paving joints
and repeated mineral identities remain separately open, not part of this revision.

Reference: VEG-001 batch116 and KIT-001 batch103, in the existing 4 × 4 m patch.
Applicable class: assets/qa/d1-stone-variants.json. Use original authored textures
and native Blender geometry; preserve the live session and original source files.
The source study permits exploring leaf maps above the current 4-pixel grass map
ceiling; this is explicitly outside production QA. Any later budget change needs
measured delivery evidence and a recorded decision, not a silent config edit.

Two artistic cycles maximum, 40 active / 60 elapsed minutes. Establish representative
plants in close context before treating distribution as successful. Capture native
close detail, unlit color, gray geometry, opposing light, overview and walking view.
Both independent reviewers and lead inspect actual images before revision.

Must fix: a single repeated plant silhouette; flat featureless leaves; lack of
secondary veins and natural restrained color variation; even planting-like spacing.
Most joints remain bare. Use irregular sparse clusters and plausible rooted contact,
low moss in protected joint recesses, and distinct grass/weed/seedling growth forms.
Geometry supplies cup/curl/silhouette; texture relief supplies smaller veins and
surface grain. Avoid oversized ribs, random noisy leaf surfaces and bright moss rugs.

Aim <=4,000 plant triangles and <=750,000 full-scene triangles. Record any source-only
class excess explicitly. Keep source, maps, provenance, timings, hashes and geometry
checks. Test a representative export/reimport once the native source is viable;
do not imply runtime compatibility from Blender evidence. RightsReviewed=false.

End with a reviewable varied patch or named failed criteria. Human artistic acceptance,
production packaging, full QA and installed-game verification remain separate.

## Cycle1 disposition

Both independent screens and lead inspected the six native views plus grass/moss
details. Fine vein/color maps improve the surface, but upright folded paddle leaves,
angular stems, rigid grass and green pebble-like moss fail the natural variety target.
Candidate1 has 3,370 plant triangles and unchanged nonplant signatures. Its external
basecolor file also needs explicit sRGB encoding and reload verification; native
packed float appearance alone did not establish saved-map correctness.

Use the second/final cycle for smoother low asymmetric rosettes, shorter curved
stems, bowed varied grass, distinct seedlings and connected fine moss cushions.
Retain restrained veins and mostly bare joints. Capture each growth form. Modest
source-only plant triangle excess may be disclosed if necessary to establish shape;
no production ceiling is changed. Correct/reload the texture and verify a representative
export if viable. No third artistic cycle is included.

## Final disposition

[Results](vegetation-results.md) retain improved leaf/grass/seedling work for human
review, with moss rejected as thin green ribbons. Regular rosettes and angular grass
remain limitations. Representative weed transfer preserves visible detail; full QA
is not passed. Both cycles end here with these named unmet criteria.
