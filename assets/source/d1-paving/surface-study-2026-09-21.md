# Complete stone surface study — 2026-09-21

Human authorization: iterate on the paving proof to find a successful original
authoring workflow, then document it before comparing other providers.

## Brief and allowance

Question: can coherent shape, relief, color and roughness authoring produce the
selected worn limestone, where independently authored block shapes and noise failed?
Inputs are selected KIT-002 batch 104 v4, MAT-001 batch 108 v1 and KIT-001 batch 103.
Nominal stone dimensions: 0.40 × 0.30 × 0.08 m. Source resolution is independent of
the existing 4000/1200/400-triangle shipping class; no budget change or admission is
implicit. A new dedicated live Blender scene preserves the earlier work.

Initial allowance: six author/capture/evaluation cycles and 90 active minutes;
three hours elapsed ceiling includes rendering/review. This deliberately expands
the default two cycles to test frequent local feedback. Record outcomes and actual
timestamps. Any extension requires a specific question and finite allowance.

Compare fixed-camera neutral oblique and reverse, raking illumination, gray geometry,
and walking scale. Must fix broad triangular facets, continuous manufactured rims,
unrelated camouflage color, uniform stippled sidewalls, and featureless tops. Preserve
broad worn areas, irregular localized flaking, subdued cream/buff/gray minerals and
physical scale. Native Blender renders only; no paintovers or substituted stills.

Start with one complete stone. If viable, make three distinct variants and a recessed
soil joint, then test a baked portable mesh and material representation. Human artistic
acceptance, full QA/library admission and installed-game acceptance remain separate.
Independent quality/consistency screens inspect the complete candidate before handoff.
End with the best supported source and reproducible recipe, or a documented failed
method and a concrete reopening question. No fabricated acceptance at the time limit.

## Run log

Author: current Codex root agent, GPT-6 family; no external generation service or
scans selected. Cycle1 created18:46UTC: original correlated procedural surface,
450,560 triangles, ~3.1s build and ~3s native GPU preview. Lead rejects the smooth
camouflage appearance and manufactured rectangular outline. Correlation alone did
not supply convincing detail. Cycle2 tests stronger silhouette variation and the
previously selected generated limestone color source for fine mineral detail;
its provenance remains in `reference/d1-paving-clean/single-surface-v1.md`.
The image supplies color only, never brightness-derived physical height.

Cycle2 lead result: warmer and more detailed, but large smooth mineral islands and
rectilinear sides still look synthetic. Cycle3 changes representation: a built-in
ImageGen-authored grayscale relief field, explicitly requested as height (not an
albedo photo), supplies irregular flaking and pits. Blender will interpret this as
artist-authored displacement at a bounded millimetre scale. Relighting and gray
inspection must expose false embossed shading or spiky relief. This is synthetic
sculpt input, not scanned/calibrated physical data. No final render may be replaced
by the generated image. Generation inputs and exact prompt are retained.

Cycle3 over-amplified the scalar image and produced crumbly relief; rejected. Cycle4
filtered the field and reduced displacement, improving stone recognition but retaining
uniform side grain and a manufactured outline. Both independent screens agreed and
specified larger localized shoulder losses and quieter fracture faces. Cycle5's new
macro material mask was accidentally cleared by changing its color space after writing
pixels; a 4×4 native probe verified that setting color space before pixels fixes it.
Cycle6 is the corrected capture, not evidence that the blank-mask appearance was an
artistic outcome. It improves the medium-scale mineral structure but the perimeter
and sides still need stronger authored form.

## Explicit extension at initial six-cycle boundary

At18:59UTC, approximately16 minutes elapsed since brief start (tool/render waits
included), extend by at most four author/capture/evaluation cycles and40 active
minutes within the original90-active-minute/three-hour ceilings. Specific question:
can stronger local shoulder/side fracture and an aligned generated albedo remove the
remaining manufactured reading, while preserving the shared relief structure?
Expected payoff: a viable complete stone and three-stone contact sample that can be
baked to a portable mesh. No quality acceptance or automatic further extension follows.

Cycles7–8: aligned generated color improved stone recognition. Lowering only upward
vertices caused raised thin rims; compressing the complete local vertical section
fixed that construction error. Six native cycle8 views passed both independent
screens as viable for transfer, with porous surfaces, repeated shoulder scoops and
pale mineral contrast still blocking a final reference match. A3900-triangle bake
retained the detail. An initial exporter scope mistake included selected objects from
other open scenes; explicit active-scene export corrected it to one mesh/material,
three textures and11,182,308 bytes, with a fresh native import/render.

Cycle9 made the top too quiet and flat; rejected as the final balance. Cycle10 combines
quieter shoulders, intermediate top relief, reduced grain and darker mineral mapping.
Three independently generated seeds/dimensions and texture offsets form a native
soil-contact sample. It reads as stone, but the broad gray regions are still too pale
relative to the accepted target. The soil is a procedural contact aid, not accepted
MAT-004 production earth.

### Explicit final extension at cycle10 boundary

At19:20UTC, about37 minutes elapsed since brief start, extend by at most two cycles
and15 active minutes within the original90-active-minute/three-hour ceilings. The
specific remaining question is whether stronger, spatially aligned worn-mineral
reflectance can recover the reference's gray/cream contrast without increasing relief.
Preserve geometry, cameras and light for the comparison. Then bake the selected final
candidate and inspect its unlit color and reimport. This is the final refinement in
this package; remaining target-match defects will be documented for human review.

## Outcome

Cycle11 is the selected experimental baseline. Eleven authoring cycles were used;
the final allowance's second cycle was not needed. Both independent screens and the
lead find a substantial improvement over the earlier source attempts, and the final
3900-triangle GLB round-trips successfully. This establishes a workable source/bake
path, not achievement of the full selected reference or installed-game paving outcome.

The unlit pass exposes residual pore lighting in the generated color source. Other
remaining defects are pervasive fine grain, recognizable shared broad patches across
variants, some straight sidewall/corner structure, and clean sample-like soil joints.
These are retained limitations, not waived acceptance criteria. No further automatic
iteration is scheduled in this work package. The next artistic decision belongs to
the human after seeing the actual source and portable result.

The [reusable workflow and comparison brief](asset-creation-workflow.md) records the
method, exact reproduction order, measurements, failed alternatives and next question.
Final authoring evidence is `surface-study-2026-09-21/cycle11/`; three-stone evidence
is `assembly-cycle11/`; the portable model, maps, receipt and focused verification are
`portable-cycle11/`. The three-stone scene remains high-resolution source; only the
single selected stone was reduced/exported. No library admission or engine change.

Retained previews and per-cycle source scripts document the experiment. Intermediate
cycle1–10 and first-assembly Blender binaries were moved outside the repository to
`C:/Users/patme/.codex/tmp/paving-study-2026-09-21-intermediates/`, with original hashes
in its archive receipt. Their older capture receipts describe those archived bytes;
they do not claim the binaries remain at their former relative paths. The selected
single source, final assembly and portable studio remain in the source package.

Storage: new creative binaries are prepared as local Git LFS pointers. Public upload
and rights clearance are not claimed; no Git commit or push is performed.
