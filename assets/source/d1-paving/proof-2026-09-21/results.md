# Bounded three-stone paving proof — 2026-09-21

The cycle11 starting point has been applied to a complete small source family and
portable delivery study. This is **not** the finished 4 m paving or installed-game
proof. Human artistic acceptance, rights, production QA and runtime acceptance remain
open. Original staged surface-study files and the live Blender session were preserved.

## Latest continuation: profile-fitted soil

The [two-cycle contact continuation](contact-continuation.md) is complete. Neither
candidate closes the appearance criterion; do not expand them into the full patch.
Profile1 uses 2,304 actual sidewall intersections to create local soil collars, with
a top-height cap sampled 2 mm inward. It adds edge accumulation but leaves the dark
strip. Profile2 samples 12 mm inward; it raises contact from a 56.7–73.3 mm range to
65.5–73.5 mm but reintroduces angular soil cuts at low bevels. Both independent
screens reject profile2: [quality](quality-profile2.md), [theme](theme-profile2.md).

The [neutral-material diagnostic](profile-contact2/diagnostic-gray.png) and
[semantic regions](profile-contact2/diagnostic-regions.png) retain exactly the same
geometry/camera. Gray denotes stone, green the fitted soil collar, orange aggregate,
and brown base soil. They show fitted soil alongside the dark strip; much of the
strip is exposed shadowed stone sidewall, not evidence of an empty opening. This
does not certify every contact watertight. Depth of field is off; softness is not
caused by camera defocus. Raising the whole contact is therefore the wrong correction.

Keep family-contact2 as the conservative assembled candidate and family2/portable
exports unchanged. Profile1 is useful fitted-contact evidence but adds a somewhat
uniform grit perimeter. The next bounded question is the overly continuous sidewall
profile/material response at the intended contact height, with geometry and intrinsic
color diagnostics before another soil adjustment. The remaining criterion is natural
contact appearance; it has not been waived or declared met by semantic classification.

Native source, five matched views per candidate, construction metrics and source/render
hashes are retained in profile-contact1/2. No new material/stone master, plant, runtime
package, engine change, or installed-game evidence was produced in this continuation.

## Retained candidates and screens

| Package | Result |
| --- | --- |
| Stone1 | Rejected: pale coated/plaster appearance after over-smoothing. |
| Stone2 | Rejected: binary mineral colors read as camouflage paint. |
| Stone3 | Conditionally viable: continuous gray/tan/cream palette, reduced relief; soft side detail and uncertain source lighting remain. |
| Contact1 | Rejected: smooth ground and scattered grit. |
| Contact2 | Rejected: excessive loose gravel. |
| Contact3 | Conditionally viable compacted earth and embedded fines; sparse joints/dark strips remain. |
| Family1 | Rejected: nonlinear coordinate changes created flowing woodgrain-like bands. |
| Family2 | Passed bounded family screen: three outlines and broad mineral identities; common fine-feature lineage remains. |
| Family-contact1 | Failed contact criterion: local soil banks cut into top bevels. Retained as failed evidence. |
| Family-contact2 | Lower soil/banks remove the obvious top-bevel cuts; exposed dark undercuts and soft edges remain. Contact fidelity is not closed. |

Authoring, diagnostic captures and independent quality/theme screening followed the
[brief](brief.md). Both reviewers used GPT-6 Astra with low reasoning; lead inspected
the actual images before dependent work. Family2 has A approximately 406 × 307 mm,
B 307 × 293 mm and C 516 × 256 mm, all about 82 mm deep. Full source geometry is
1,730,560 triangles per stone. These source counts are not runtime budgets.

Selected references: KIT-001 batch103 paving assembly, KIT-002 batch104 stone family
v4, MAT-001 batch108 cream limestone, MAT-018 batch108 joint soil, and the courtyard
kit. Generated scalar/color inputs derive from the preserved surface-study provenance;
candidate scripts retain seed, transformation and input lineage. No new image-provider
job, paid generation, downloaded art or public upload was performed in this package.

## Portable delivery evidence

Each member was independently reduced, UV-unwrapped, baked and exported, then loaded
into a fresh Blender scene. [Measured checks](portable-family-verification.json):

| Member | Triangles | GLB bytes | Sampled source-to-low p95 distance |
| --- | ---: | ---: | ---: |
| A | 3,900 | 8,405,804 | 0.537 mm |
| B | 3,900 | 8,914,548 | 0.476 mm |
| C | 3,900 | 9,288,268 | 0.555 mm |

Each has one mesh/material and three textures: 2048 base color, 2048 tangent normal,
1024 roughness. Closed-manifold, finite coordinate and UV-range checks passed.
Loaded native-low/reimport pixel mean differences are below 0.0000005; p99 is zero.
These checks establish a narrow native export/reimport result, not UV-overlap,
opposing-light portable fidelity or Babylon compatibility. The three reimport views
retain the screened family appearance, with minor faceting/softness.

All three uncompressed GLBs exceed the existing 8 MiB per-resource ceiling. Three
separate stone materials plus soil/plants also exceed the three-material scene target.
They are source evidence, not admitted packages. Shared atlas/material work, compression,
LOD chains and the full existing QA gate are required; no budget was changed.

## Remaining limitations and next dependency

- Base color is a transformed generated image, not calibrated reflectance. Some
  low-amplitude source lighting may remain; do not label it proven intrinsic albedo.
- Sidewalls and edges remain soft/pitted; family B is busier and C has elongated
  features. The 4 m repeat test has not run. Distinct broad identities do not establish
  a fully independent stone population.
- Contact integration is assessed separately from successful portable transfer. The
  source scene's dense earth/grit geometry has not been reduced or baked for runtime.
- Joint plants, full 4 m arrangement, LOD/compression, shared materials, rights clearance,
  QA admission and installed Chrome/WebGPU captures are still required. Engine changes
  remain authorized where an actual integration gap calls for them.

No engine/game code changed; no runtime/performance or full smoke claim is made.

Latest assembled evidence is [family-contact2/source.blend](family-contact2/source.blend)
and its five native views. Its 64 mm nominal soil and 2 mm local bank expose more of
the real bevel than contact1. Lead sees the clipping correction but a longer dark
undercut in the close view, so the contact requirement remains open. The next geometry
question is conforming local joint fill to actual lower sidewall profiles without
crossing top bevels, rather than another global height/material adjustment. Do not
replicate the unresolved contact across the full patch. The finite source session
ends with this named limitation, not an acceptance claim or automatic retry allowance.

Both independent final screens agree it is reviewable but not fully accepted:
[quality](quality-contact2.md) and [theme](theme-contact2.md). Neither sees obvious
detached hovering at walking distance; both retain the close dark-trench limitation.
Separate [quality export screen](quality-final.md) and [theme export screen](theme-final.md)
cover the three fresh imports. The source study advances the pipeline but does not
close the paving proof.

Sixteen retained final-contact source/render and family GLB hashes were independently
recomputed successfully; `git diff --check` passed. Original staged surface-study
files and the new production workflow still have no unstaged diff. Native source
scripts and receipts remain beside outputs for reproduction with pinned Blender5.2.1.

Native Blender construction, actual renders and fresh imports are the focused checks.
The physical smoke gate stays at the exact M4.5 exit candidate. Changes remain
uncommitted; no public asset upload occurred.

## Later continuation

The [2026-09-22 results](../proof-2026-09-22/results.md) supersede this package's
next-action note: two sidewall revisions failed, while a matched control exposed
material-detail loss relative to the original cycle11 material. The older portable
checks above remain evidence for their exact outputs, not for the new restoration.

## Source recovery

Family-contact1 rendered successfully but Blender failed the final file rename, leaving
`source.blend@`. Its bytes were copied unchanged to `source.blend`, reopened in a fresh
process and rendered again. The [receipt](family-contact1/receipt.json) reports a mean
pixel difference of 0.00000553, p99 zero and maximum 3/255; lead inspected the repeated
image. This is a readable recovered scene, not a claim of bit-identical rendering.
One retained image-node datablock references the existing baseline height PNG rather
than a packed copy, explicitly recorded in the receipt. Keep the source lineage intact.
The open interactive Blender document was not changed.
