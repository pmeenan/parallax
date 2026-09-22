# Paving continuation — 2026-09-22

The two bounded sidewall attempts did not close the paving proof. A matched material
diagnostic instead exposed a regression from the improved cycle11 starting point.
The [brief](brief.md) scoped one restoration candidate. Both independent screens and
lead retain the corrected family as the working small-sample baseline, not a full
paving or clean-albedo pass.

Latest: the [moving-light test](relighting-results.md) found no concrete directional
conflict. Both reviewers and lead withdraw the unlit-only blocker; preserve the
restored material and advance practical delivery/repetition work. Human-approved
edge appearance remains settled. Source lighting is unproven, not certified absent.
The [fresh restored-family transfer](transfer-results.md) then passed focused
3,900-triangle roundtrip checks and conditional independent visual screens. Proceed
to the 4 m repetition/plant study with current reduced assets; raw file-size overages
and a small C shading artifact remain delivery work.

## Evidence and disposition

- `source-audit.json`: all nine connected image nodes loaded valid 1254-square
  images. Eight were packed and the remaining external height source exists.
  Depth of field was disabled. Missing images or camera defocus do not explain softness.
- `sidewall1`: localized inward facets preserved top interiors, soil and lower
  contact coordinates but retained the smooth dark band and thin ledge.
  [Quality](quality-sidewall1.md) and [theme](theme-sidewall1.md) reject it.
- `sidewall2`: broader inclined shoulders reduced the ledge at the cost of a wavy
  apron and pinched corners. [Quality](quality-sidewall2.md) and
  [theme](theme-sidewall2.md) reject it. Do not carry either shape forward.
- `material-control`: original cycle11 material on A alone, with B/C as unchanged
  normalized controls. Matched oblique, reversed-light and joint-detail views show
  markedly better warm mineral separation and fine detail on A. Both
  [quality](quality-material-control.md) and [theme](theme-material-control.md)
  support one family restoration while retaining the earlier geometry and remaps.

Both geometry attempts have finite coordinates and no degeneracy or normal flips
in 20,000 sampled edited triangles per member. Those narrow checks do not substitute
for the failed visual screens. Receipts, editable native sources and actual renders
remain beside each attempt, using verified Blender 5.2.1 LTS in isolated processes.
The live unsaved Blender scene and staged cycle11 source were left untouched.

## Color-transfer correction

During restoration, a known sRGB byte-image fixture exposed a color-space mistake:
Blender's image pixel accessor returned 128/255 as approximately 0.5019608, not the
decoded linear value 0.2158605. Copying those values into a float Non-Color texture
made B/C too pale. The restoration must explicitly decode sRGB before remapping into
linear storage. This is a measured input-transfer correction, not an artistic
brightness adjustment or an intrinsic-albedo solution. Do not assume every Blender
image buffer exposes the same encoding; preserve a fixture with this source recipe.

## Retained restored family

[Editable source](restored-family/source.blend), [oblique](restored-family/oblique.png),
[opposing light](restored-family/reverse-light.png),
[walking distance](restored-family/walking.png), [overcast](restored-family/overcast.png),
[joint detail](restored-family/joint-detail.png) and
[unlit color](restored-family/basecolor-unlit.png) form the reviewable result.
Both [quality](quality-restored-family.md) and [theme](theme-restored-family.md)
reviewed all six actual final views; lead independently inspected them.

A/B/C now share the richer original mineral response while retaining their distinct
broad patterns. B/C's pale transfer mismatch is corrected. Geometry, mesh connectivity,
transforms and soil remain unchanged by recorded hashes. The final build and six
captures took 30.27 seconds, excluding authoring, review and the rejected encoding
attempt. Seven final source/render hashes were independently recomputed successfully.
`git diff --check` passed; staged original source/workflow files have no unstaged diff.

Outcome: retain this corrected baseline and defer the rejected sidewall techniques.
The subsequent moving-light diagnostic did not justify a color rewrite. Preserve
the current material and move to fresh delivery/repetition evidence; do not repeat
global color normalization or sidewall deformation. Human approval below closes
the small-sample edge appearance criterion.

## Human edge approval — 2026-09-22

The human reviewed the restored-family sample and stated: "The soil to stone edge
looks good to me". The soil-to-stone edge appearance is accepted for this sample.
Preserve its geometry and soil placement; do not pursue further sidewall/contact
appearance tuning based on the earlier agent reservations. Those screens remain
historical evidence, superseded on this artistic point by the human decision.
This approval does not resolve source-lighting contamination or certify the later
full patch, export or runtime result.

## Remaining proof boundaries

The material control still shows physical sidewall shadow. Its generated color input
may contain source illumination; restored contrast does not establish clean albedo.
The new 3,900-triangle transfer checks now cover the restored material. Full 4 m
repetition with joint plants is now captured in the [bounded patch study](patch-results.md),
with repetition, long-joint and foliage criteria still unmet. Final artifact correction and shared
materials, compression/LODs, full QA, rights review, admission and installed WebGPU
verification remain outstanding. No engine change, runtime result or broader artistic
acceptance is claimed beyond the human's edge and subsequent lighting approvals. Work remains uncommitted;
no public asset upload occurred.

The [two-cycle moss continuation](moss-results.md) now retains candidate1's low leafy
colony for human review, with its own focused Blender export/reimport check. This
replaces the rejected smooth moss ribbons as the working source proposal; it does not
grant moss artistic acceptance or a production-cost pass.
