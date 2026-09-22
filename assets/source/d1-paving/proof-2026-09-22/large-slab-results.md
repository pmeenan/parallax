# Larger-slab layout study — 2026-09-22

**Superseded direction (human feedback, 2026-09-22):** return to the earlier
smaller stones for their cobblestone-like appearance. The observations and proposed
next method below record this experiment's outcome; they no longer set the active
stone scale or require a broad-slab source family. See the current direction in
[the source overview](../README.md).

This bounded 4 × 4 m source test improves slab proportions but does not finish
KIT-001 paving. Retain candidate2's exact-cover layout as a provisional adjacency
base; neither rendered scene is an integrated or accepted paving patch. Both scenes
reuse only three earlier mineral identities with enlarged XY transforms and contain
provisional older plants rather than the human-approved leaf color and moss.

## What changed in the actual native scenes

| Evidence | Stones | Longest modeled internal seam | Native result |
| --- | ---: | ---: | --- |
| [Earlier mixed layout](layout-study/candidate1/top-packing.png) | 111 | 16/28 cells | Small-paver cadence and long registered runs |
| [Larger slabs candidate1](large-slab-study/candidate1/top-packing.png) | 61 | 14/28 cells | Broader walking-scale pieces; large plates and narrow strips form separate zones |
| [Balanced merges candidate2](large-slab-study/candidate2/top-packing.png) | 58 | 14/28 cells | Slightly better interleaving; straight local alignments and overscaled markings remain |

The first preflight made rectangular full-edge unions of the previous exact-cover
layout, capped at 8 planning cells (1.14 m) per side and 2.5:1 aspect. Twelve
deterministic candidates yielded 61 stones and a 14-cell longest seam. Candidate1's
actual [sunny](large-slab-study/candidate1/sunny-oblique.png),
[opposing](large-slab-study/candidate1/opposing-light.png),
[overcast](large-slab-study/candidate1/overcast.png),
[walking](large-slab-study/candidate1/walking.png), top and plant-contact views were
inspected by lead and both independent [quality](quality-large-slab1.md) and
[theme](theme-large-slab1.md) screens. The larger slab cadence is closer to the
approved Batch103 reference, but the rectilinear kit, broad T-junction earth wedges,
oversized mineral islands and repeated pale landmarks remain visible.

The final preflight retained the same starting layout but ranked merges using seam
cost, four-quadrant large-slab coverage and adjacent narrow-strip pairs. Eighty
deterministic candidates yielded 58 stones, a 14-cell seam and 5,271 long-seam
penalty (5,461 in candidate1). Recomputing the distribution metric on candidate1
gives 48 cells' quadrant coverage spread and 72 adjacent narrow pairs; candidate2
records 40 and 57. This is a modest numeric improvement, not a new stone family.
Candidate2's actual [sunny](large-slab-study/candidate2/sunny-oblique.png),
[opposing](large-slab-study/candidate2/opposing-light.png),
[overcast](large-slab-study/candidate2/overcast.png),
[walking](large-slab-study/candidate2/walking.png), top and plant-contact captures
were inspected by lead and both independent
[quality](quality-large-slab2.md) and [theme](theme-large-slab2.md) screens. All
three find modest improvement in broad-slab distribution, but several long
registered joints and pockets of narrow rectangles remain visible. The huge pale
islands on broad faces are particularly
prominent at walking height.

Blender 5.2.1 built each candidate in an isolated process. Candidate1 has 334,908
scene triangles (237,900 stones, 94,240 ground, 2,768 provisional plants), no
conservative stone AABB overlaps and 9.96 mm minimum AABB clearance. Candidate2 has
322,256 scene triangles (226,200 stones, 93,288 ground, 2,768 provisional plants),
no conservative AABB overlaps and 9.73 mm minimum clearance. Both receipts report
clear provisional roots and no low plant vertices inside conservative stone bounds.
These are bounding-box checks, not exact triangle-pair distances. Source XY scale
ranges are 0.676–3.301 and 0.531–3.692; at the upper end the mineral detail is
visibly magnified beyond the earlier stone's authored physical scale. Ground remains
well above its 8,192-triangle production target. All eight recorded file hashes and
sizes for each candidate, both layout-source hashes, three input Blend identities
and the contact recipe were independently rechecked.

Reproduction order: run `layout.py` and `layout2.py`, format their generated JSON
with the repository Biome pin, then run each candidate's `build.py` in a separate
Blender 5.2.1 process and format its receipt JSON. The saved receipts identify the
formatted layout bytes consumed by the native builds. Local Blender `.blend1`
backups and Python bytecode are ignored and are not evidence inputs.

## Disposition and next method

End the rectangular-merge experiment at the two-cycle boundary. The selected
layout is only a source starting point for contact and adjacency. The next bounded
source package must author genuinely distinct broad limestone faces at their
intended physical size, then adjust the packing with less orthogonal registration
and narrow infill where needed. Import the human-approved leaf-color and moss
sources and recheck joint rooting/clearance in that new layout before asking for
integrated artistic acceptance. No engine import, complete glTF/asset QA, rights
review, LOD/compression, production budget or installed-game proof was obtained.
The M4.5 physical smoke remains deferred to its exact exit candidate.
