# D1 paving — individual limestone source

**Latest human approval (2026-09-22):** the procedural, periodic
[photoreal rebuild](proof-2026-09-22/photoreal-results.md) `photoreal/candidate1` is the
approved visual baseline. Its seeded [builder](proof-2026-09-22/photoreal/build.py) is
the reference implementation of the standing
[asset production workflow](../../production-workflow.md) (D-196). It supersedes
`production/candidate3`. Everything below documents the earlier generated-image/bake
lineage (candidate3, the cobble, larger-slab and broad-family studies) and is diagnostic
history, not a delivery input. Review found clamped displacement seams in the approved
snapshot; the builder is corrected, while boundary-normal and installed tiling checks
remain delivery work. See the photoreal result's known limits.

**Metadata formatting cleanup (2026-09-23):** retained JSON now follows Biome formatting.
Parsed measurements, verdicts and artwork are unchanged; dependent SHA-256 and byte-count
records now identify the reformatted files. Original serializations and identities remain
in Git at `e8de418ecf85e9dd4ad04a4531723dff8fc8dc43`. This is a metadata maintenance pass,
not a new generation, measurement or acceptance. Earlier lint-blocked handoffs are
historical; see the current [plan status](../../../docs/plan.md).

The [smaller-stone result](proof-2026-09-22/cobble-results.md) now combines 137 earlier
stones with the approved leaves and moss. Its longest modeled joint is 10 cells
(previous mixed layout: 16), with residual long alignments and repeated mineral
patterns still visible. The human approved the presented result with those
disclosed limits; further appearance refinement is optional backlog work.
Saved-source artwork checks and a fresh fitted-moss transfer pass. Ground and
vegetation exceed their production targets; production optimization, full QA,
rights review and installed-game verification remain open.

The human-approved [production reduction proof](proof-2026-09-22/production-results.md)
is `production/candidate3`: ground triangles fall 58.4%, plants 40.6%, with all stone
artwork/placements unchanged. Strict-budget collapse was rejected for visible
damage; the retained source preserves leafy moss and volumetric grit and passes
representative leaf/moss/grit Blender transfers. It still exceeds the old ground
and vegetation class limits. Next: shared materials, LODs and measured compressed
resource/runtime costs before deliberate class calibration and QA admission.
The game asset and production ceilings are unchanged.

**Current 2026-09-22:** the [latest continuation](proof-2026-09-22/results.md)
rejected two sidewall revisions. A matched control found that the earlier material
normalization washed out cycle11's mineral detail. The restored family, including a
verified sRGB transfer correction, is retained after both independent screens with
the earlier geometry and distinct remaps. The human approved the soil-to-stone edge
on 2026-09-22; preserve that contact. The subsequent
[moving-light test](proof-2026-09-22/relighting-results.md) demonstrated no directional
conflict; both reviewers support preserving the material and advancing delivery and
repetition tests. Intrinsic albedo remains uncertified, rather than a proven blocker.
The [current transfer](proof-2026-09-22/transfer-results.md) provides three freshly
baked/reimported 3,900-triangle stones with conditional visual passes. The human
approved lighting. The [4 m patch study](proof-2026-09-22/patch-results.md) now retains
131 stones with continuous soil and eight plant groups for human review. Repeated
mineral identities, long joints and simplified foliage remain unmet appearance
criteria after two cycles; source ground cost also exceeds the production target.
Raw resource sizes and a small C shading artifact still need delivery correction.
The subsequent [vegetation revision](proof-2026-09-22/vegetation-results.md) adds
leaf color/normal detail, smoother rosettes, seedlings and bowed grass. Moss remains
rejected as green ribbons; plant geometry/maps exceed current production targets.
The two-cycle result and representative weed transfer are retained for human review.
The [subsequent color refinement](proof-2026-09-22/leaf-color-results.md) adds clearer
within-leaf variation and leaf-age tints, with verified representative export retention.
Both screens support human color review; geometry and relief are preserved.
The human approved that leaf-color refinement. The following
[moss study](proof-2026-09-22/moss-results.md) retains a low leafy colony in place of
the rejected ribbons, with representative Blender transfer verified. The human accepted
its appearance on 2026-09-22. Stone repetition and long-joint correction remain open.
The following [bounded layout study](proof-2026-09-22/layout-results.md) reduced
the longest modeled joint from 28 to 16 planning cells. Both native screens still
find regular long runs and repeated mineral landmarks; the global-warp trial is
closed without adoption. The approved leaf/moss have not been integrated into
the new layout.
The next [larger-slab study](proof-2026-09-22/large-slab-results.md) reduced the
field to 58 stones and the longest modeled joint to 14 cells. Candidate2 is a
provisional layout base only: the three reused mineral sources are visibly magnified
and repeated on the broad slabs, some narrow-strip clusters and straight joints
remain, and the approved leaf/moss are not yet integrated. Both independent
screens and lead inspected the native result; whole-patch acceptance remains open.
The [broad source family study](proof-2026-09-22/broad-family-results.md) now retains
four stones constructed at their physical size. Candidate2 reduces obvious repeated
large landmarks, but dense warped mineral patterns remain a fidelity problem.
Matched walking/grazing comparisons also expose source-to-bake color differences
despite a consistent 3,900-triangle export/reimport. The source and three transfer
diagnostics remain provisional/failed evidence; no new asset is admitted or installed.
The previous [three-stone/contact proof](proof-2026-09-21/results.md)
applies the complete-asset workflow to cycle11: revised mineral color, three shapes
and surface identities, compacted soil contact, and three independently baked/reimported
3900-triangle stones. This is a bounded source study for human review, not paving
acceptance. Earlier contact reservations and uncertain source lighting remain documented;
the human's latest edge approval supersedes those contact appearance reservations.
Two fitted-soil trials also failed to close the contact appearance. Neutral/semantic
diagnostics show much of the long dark band is an exposed shadowed stone sidewall;
raising soil alone reintroduces bevel clipping. Retain the earlier family-contact2
geometry and soil placement now approved for the small-sample edge appearance.
The [overall continuation](paving-proof-followup-2026-09-21.md) still requires the
4 m assembly acceptance, production packaging, QA/admission and installed-game verification.
Develop shape and material together; the gray-only gate below is historical.

## Earlier proof status

**Current2026-09-20:** D-195 accepts the concept collection and resumes the
[small assembled proof](proof-2026-09-20.md). New work uses a sibling source script
and separate result directory with explicitly verified Blender5.2.1. The historical
5.1.2 scripts and prior source evidence below are preserved. The old full assembly
was rejected for uniform pale slabs, exposed shoulders, flat joints and weak plants;
an `accepted-hero-final` folder name does not grant assembly acceptance. Export and
library expansion wait for a viable new source proof and their separate gates.
The initial two-cycle proof has finished without a viable appearance match; see the
brief for rejected evidence and the proposed isolated stone/joint follow-up.

## Historical individual source

Current work uses original, closed individual stone meshes and the accepted
[generated single limestone surface](../../reference/d1-paving-clean/limestone-single-surface-v1.png).
`individual.py` assembles eight hero-derived variants from `stone_geometry.py` into
a deterministic 4m courtyard with 153 rigid placements, original earth/grit and
joint-rooted low grass. `hero.py` retains the isolated geometry/material comparison.
The individual candidate is being exported and validated; the previous periodic
library asset remains the installed baseline until admission and integration.

Reconstruct the current source with pinned Blender 5.1.2:

```powershell
blender --background --python-exit-code 1 --python assets/source/d1-paving/individual.py -- --output harness/results/d1-individual-stones-2026-09-05/accepted-hero-final
blender --background --python-exit-code 1 --python assets/source/d1-paving/export_individual.py -- --source harness/results/d1-individual-stones-2026-09-05/accepted-hero-final --output harness/results/d1-individual-stones-2026-09-05/accepted-hero-final/export
```

The selected material is generated diffuse detail, not a scan or calibrated PBR
measurement. Original geometry supplies broad shallow fractures and variable worn
shoulders. Original procedural fine bump is restrained to 0.14mm effective scale;
it is independent of diffuse brightness. Rejected CC0 sandstone maps are retained
only in comparison evidence and are not selected source inputs. The texture field
represents 50×50cm; bounded UV offsets and quarter turns vary its use, though one
surface image inevitably limits unique mineral patterns. Tone factors remain
within [0,1]. Each 73mm stone is nominally buried 57mm, exposing approximately
16mm above flat earth. Source slope previews rotate whole stones rigidly; production
terrain fitting is evaluated independently by the renderer integration.

The near/mid/far stone budgets are 3900/1150/380 triangles per variant. Earth and
embedded aggregate use 6922/1950/498 triangles; double-sided low grass uses
3780/1960/980. The flat courtyard's 153 near stones plus earth and grass total
607402 rendered triangles, while all stored variant LOD geometry totals 59530.
The 150 plant root footprints have a 2mm radius and require a further 1mm clear
margin. The gate measures against combined geometry hulls from all LODs; the
final source minimum surplus is 1.06049mm. Earth ORM uses a documented local
distance-to-stone-footprint occlusion estimate, independently of diffuse color;
it is not measured occlusion or baked directional lighting.

The canonical export uses glTF UV `(u,1-v)`, top-origin texture rows and unchanged
OpenGL normal RGB, with tangent sign negated for the V reflection. Production
renderer validation owns the matching tangent-frame convention. Source
renders and noise diagnostics live under `harness/results/d1-individual-stones-2026-09-05`.
Bump-off and 256-sample checks show most visible fine grain belongs to the generated
diffuse rather than compression (which had not run) or Cycles sampling. Source PNG
comparison metrics are normalized RGB, not a claim of linear-light measurement.

Periodic, finite, and scan workflows below are retained source history.
## Historical scan source — superseded

The sparse shader slabs and two subsequent authored-block models were rejected by
visual inspection. Their uniform shoulders and synthetic surface response miss the
[courtyard reference](../../reference/d1-courtyard-sunny-gloomy.png).
The previous source used the human-selected
[Stone Pathway 02](https://polyhaven.com/a/stone_pathway_02) scan by Amal Kumar,
licensed [CC0](https://polyhaven.com/license). It superseded the earlier, overly
regular `cobblestone_pavement` comparison. Exact input hashes and rights provenance
are in [provenance.json](provenance.json).

Blender 5.1.2 constructs real relief from the scan's displacement map and pairs it
with the matching color, OpenGL normal and roughness maps. The complete UV tile
covers 2 × 2 metres. Four original 4096 × 4096 PNG maps remain unmodified in ignored
local inputs. The material lifts diffuse HSV value to 2.4 and reduces saturation to
0.72 toward the brighter courtyard palette; this does not convert the source stone
into a scientifically identified limestone. Normal strength 0.35 is a preview
compromise pending frequency-separated baking.

The 65 mm full-range displacement scale produces about 58 mm of actual relief.
Three source grids contain 524,288 / 32,768 / 2,048 triangles. These are source
comparison meshes, not approved runtime LODs. Fine relief should be baked into maps
and tested on a budgeted game mesh; shipping the dense sculpt is not the proposal.
The scan includes dry leaf litter, which differs from the greener courtyard joints.
Twenty-six small modeled grass clumps add 3,980 triangles. Their seeded roots are
selected in recessed joints beside higher stone lips; three views were inspected for
plants floating above the joints or appearing on stone tops.

Run with the input directory containing the four files listed in provenance:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.1/blender.exe' --background --threads 8 --python-exit-code 1 --python assets/source/d1-paving/generate.py -- --input harness/results/d1-paving-rework-2026-09-05/scanned-input --output harness/results/d1-paving-rework-2026-09-05/new-source-attempt
```

Use a fresh output directory. The generator validates input hashes and dimensions,
requires Blender 5.1.2, and confines outputs to this checkout's ignored results.
The saved `.blend` retains image links to the local inputs. Sunny, overcast and
grazing renders are source previews; none is an in-game capture or runtime cost.

[Comparison report and source previews](../../../harness/results/d1-paving-rework-2026-09-05/summary.md).
The earlier attempts remain in their result directories; no rejected authored-block
generator is retained as an active implementation.

The source-only modeling step is complete. The integration below adds the baked
module, paving-class QA, immutable storage (D-186 resolves P-004), installed PBR
dependencies and registered material pipelines. Library admission establishes asset
integrity; finished-art acceptance still requires the actual game captures.

## Historical scan source → runtime module

The user accepted the scan source as the starting point for the game asset on
2026-09-05. `export.py` extracts three 2 m modules (32,768 / 8,192 / 2,048 stone
triangles), retaining actual scan relief and a 48-byte position/normal/UV/tangent
source layout. Production resources use the established 32-byte position/normal/UV
layout and the PBR shader derives its normal-map tangent frame. Complete grass
blades reduce with distance; their back faces are explicit
geometry so all surfaces use the same single-sided PBR pipeline. The first installed
Chrome evaluation exercises all three LODs and streaming re-entry; runtime artistic
acceptance remains open, including joint/vegetation fidelity at the reduced density.
See [the installed captures and evaluation](../../../harness/results/d1-paving-integration-2026-09-05/summary.md).

Color is baked using the source's linear-space HSV adjustment, then encoded as
sRGB. Color and normal maps are 2048², ORM is 1024², all with complete mip chains.
The ORM channels are white occlusion, scanned roughness and zero metallic. The
source's 0.35 normal strength remains explicit; frequency-separated rebaking is
not claimed. Only 0.0151% of linear color components clipped during the brighter
8-bit diffuse bake. The grass uses three tiny constant maps. Source preview
subsurface scattering is not reproduced by the initial runtime grass material.

`assets/qa/prepare-d1-paving.mjs` produces canonical single-buffer meshopt GLBs and
shared KTX2 resources after structural checks; `admit-d1-paving.mjs` additionally
requires a digest-bound production-worker decoding receipt before writing immutable
library objects. The GLBs retain valid raw fallback views for offline tooling;
production packaging consumes separately checked 32-byte compressed vertex views
and compressed indices, avoiding duplicated geometry and unused tangent bytes.
The initial complete runtime resource set is 13,241,937 bytes.
See [the focused QA instructions](../../qa/README.md) for commands and checks.

## Retained finite clean limestone baseline

The user accepted `assets/reference/d1-paving-clean/limestone-v2-rough.png` as the
new starting image. `clean.py` constructs a **finite 2 m patch**, retaining that
bitmap's composition and color. It is not tileable; the runtime material must clamp
at its perimeter. No reflected copies or color seam blending are applied.

`clean-layout.json` hand-traces 13 stone silhouettes, including the small infill,
and locates 17 shallow hollows and 24 surviving flake ridges against the reference.
These define authored metric relief: nominal 14 mm recessed joints, uneven
22–32 mm shoulders, hollows up to 5.6 mm and ridges up to 4.5 mm. Broad faces remain
walkable. Adaptive point selection followed by planar Delaunay triangulation and
height resampling avoids projected folds and preserves a complete UV square.

The original bitmap is only resampled for export, not repainted or de-lit.
Normal data contains only an inferred high-frequency color residual bounded to
0.2 mm; it does not repeat macro geometry relief. Normal strength is explicitly 1.
Roughness is authored (approximately 0.79–0.84 on stone, 0.94 in joints), not scanned.
Residual lighting and apparent fine pits baked into the reference remain a known
limitation. This is generated art with estimated material maps, never a measured
scan or a CC0 asset. `clean-provenance.json` records generation lineage, exact input
hashes and the reviewed output terms.

Vegetation is separate geometry, seeded only in the new joint masks. Every root
has at least 4 mm contour clearance; six additional footprint samples must also
lie in joints. The 120/60/30 blades are independently anchored 1.5 mm beneath each
exported LOD's actual surface. Back faces remain explicit geometry.

Reproduce with the installed Blender 5.1.2:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' --background --python assets/source/d1-paving/clean.py -- --output harness/results/d1-paving-clean-2026-09-05/cycle2-final
node --experimental-strip-types assets/qa/prepare-d1-paving.mjs harness/results/d1-paving-clean-2026-09-05/cycle2-final/export harness/results/d1-paving-clean-2026-09-05/cycle2-final/candidate
```

The output includes the retained source blend, overhead and grazing previews,
an additional directional-light grazing preview, numerical geometry evidence,
raw export inputs and the structurally checked compressed candidate. Source
previews are not evidence of actual-game appearance. Admission additionally needs
the production-worker receipt and integration evaluation.

The final candidate has 32,704 / 6,908 / 1,686 stone triangles and
4,560 / 2,280 / 1,140 double-sided grass triangles. Its 18 runtime objects total
13,361,567 bytes; including the three canonical source GLBs gives 16,463,343 bytes.
The existing 2K color/normal, 1K ORM and complete-mipmap contract is preserved.
Structural checks pass: finite geometry, scale, normalized normals, triangle
budgets, UV winding and complete square coverage, canonical meshopt layout and
KTX2 mip chains. Sparse lower-tier perimeter protection leaves 2,946 / 719
interior vertices in LOD1/2; their sampled height RMS relative to LOD0 is
1.04 / 2.38 mm (95th-percentile absolute errors 1.90 / 5.92 mm). The largest
LOD2 discrepancy is 13.19 mm in narrow features, so its use remains distance-bound.
See `cycle2-final/lod-interior-audit.json` and `lod2-grazing.png` in the result
directory for numerical and visual far-LOD evidence. Actual-game evaluation is
recorded separately in the integration summary linked above.

## Periodic clean limestone candidate

The periodic source preserves the accepted rough-v2 mineral surface. A subsequent
imagegen attempt did not align its edges and was rejected as a tileable input.
Instead, `periodic.py` UV-maps complete unchanged rough-v2 stone samples onto the
explicit toroidal packing in `periodic-packing.json`, then emission-bakes their
color. Nineteen stable stone IDs use varied rectangular footprints, small infill
and quarter-turn rotations; source contours, hollows and flake ridges undergo the
same transform. No samples are mirrored. Anisotropic scale ratios stay within
0.8–1.2. A small periodic displacement of boundaries breaks exact grid lines.
The coursed intermediate atlas was rejected and is not the admitted candidate.

Stones cross tile boundaries as complete repeated IDs. Every geometry LOD uses
the same 128-interval perimeter and height profile; vertex normals derive from
the wrapped height field. Fine-map filters and normal derivatives also wrap.
Separate earth uses periodic mineral-grit shading, small compaction relief and
restrained fine normals. Grass roots remain inside the joint mask with footprint
clearance and 1.5 mm burial against each LOD; blade triangles crossing the perimeter
are clipped and translated to continue at the opposite edge. Runtime textures
require `repeat` addressing. This remains a rigid planar module; following terrain
contours per stone is not implemented. Source IDs and transforms remain available
for that future work.

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' --background --python-exit-code 1 --python assets/source/d1-paving/periodic.py -- --output harness/results/d1-paving-periodic-2026-09-05/courseless-final
node --experimental-strip-types assets/qa/prepare-d1-paving.mjs harness/results/d1-paving-periodic-2026-09-05/courseless-final/export harness/results/d1-paving-periodic-2026-09-05/courseless-final/candidate
```

The candidate has 27,248 / 6,430 / 1,962 stone triangles and
4,564 / 2,280 / 1,140 double-sided grass triangles. Its 18 runtime objects total
13,284,990 bytes; all 21 objects including canonical GLBs total 16,032,930 bytes.
Structural and periodic QA pass: 2,322 opposite-edge/all-LOD comparisons measure
zero height difference and a maximum normal difference of 0.00000171 degrees.
Texture edge-gradient diagnostics are comparable to ordinary interior gradients;
they do not independently establish artistic acceptance. Source evidence is under
`harness/results/d1-paving-periodic-2026-09-05/courseless-final/`, including the
2×2 shaded geometry preview and numerical reports. All 18 production-worker decodes
passed with zero external requests before library admission. Installed lighting
evaluation remains the next handoff. Repeated source-face features, pale joints
and residual lighting baked into the generated reference remain visual limitations;
neither a measured scan nor final AAA artistic acceptance is claimed.
