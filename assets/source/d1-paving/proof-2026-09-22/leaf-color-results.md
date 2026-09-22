# Leaf color result — 2026-09-22

## Human acceptance

The human reviewed candidate2 and responded "much better, thank you". Treat this
as acceptance of the leaf-color revision. Preserve this color baseline in subsequent
work. This does not close moss, vegetation geometry, production QA or runtime proof.

Retain the second color candidate for human review. Both independent
[quality](quality-leaf-color2.md) and [theme](theme-leaf-color2.md) screens find
clearly improved within-leaf variation, with a healthy majority and no noisy speckle.
Lead inspected all five native views and the representative transfer pair and agrees.
Between-leaf age differences and faded margins remain restrained; broad patches can
still look somewhat cloudy. The subsequent human acceptance above closes this color decision.

## Review evidence

- [Matched close](leaf-color/candidate2/close.png)
- [Opposing light](leaf-color/candidate2/close-opposing.png)
- [Unlit plants](leaf-color/candidate2/close-unlit.png)
- [Walking view](leaf-color/candidate2/walking.png)
- [Overview](leaf-color/candidate2/overview.png)
- [Editable source](leaf-color/candidate2/source.blend)
- [Native representative](leaf-color/candidate2/transfer/native.png)
- [Fresh import](leaf-color/candidate2/transfer/reimport.png)

Original botanical color variation now includes broader interveinal green pockets,
different leaf-age tints, partial fading on six of 26 leaves and one additional
localized blemish. Geometry, topology, UVs and transforms are hash-identical to the
vegetation baseline. Normal/roughness dependency graphs and nonleaf color graphs
are unchanged. Existing moss/grass-shape/paving limitations are not resolved by
this color-only package.

Candidate1 was too subtle according to both screens and lead. Its first export also
selected an old COLOR_0 attribute while placing intended tints in COLOR_1, and lost
a separate shader gain. The equivalent correction explicitly selects LeafAgeTint
as COLOR_0 and moves the common gain into the saved sRGB map. Final native rendering
uses the saved/reloaded map. The final GLB audit finds intended COLOR_0, no COLOR_1,
and 178 unique normalized colors across 484 exported leaf vertices.

The representative export has 1,016 triangles, two meshes/materials, three textures
and 2,473,960 bytes. Native/reimport mean absolute loaded-pixel difference is
0.000170708, p99 0.003922; visible leaf ordering and within-leaf variation survive.
Native 2.5% subsurface remains a known standard-glTF difference. This is a conditional
Blender specimen transfer pass, not full glTF validation, engine compatibility or QA.
Final native build/capture took 30.21 seconds; representative transfer run 7.73 seconds,
excluding authoring and review. Lead verified all 19 inventory hashes/sizes.
Source SHA-256: `ce87022690f941b09cd4741b6215e31272beee748b375058c70c29a4ca2c1db4`.

The two artistic cycles end here. Retain the result for human color judgment.
Vegetation remains 6,773 triangles, beyond the 4,000 target; source maps remain beyond
the four-pixel production grass profile. No budget changed. Moss remains rejected;
full packaging, rights review, QA/admission and installed-game proof remain open.
Original staged source/workflow and live Blender session are untouched. No commit,
public upload or runtime admission occurred.
