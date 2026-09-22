# Broken-joint layout study — 2026-09-22

The two native cycles are complete. The 111-stone mixed layout is a measurable
improvement over the earlier 131-stone patch, but it still does not meet KIT-001's
varied-slab appearance. Retain candidate1 as a source-layout baseline for the next
method. Candidate2's global warp is a diagnostic, not an adopted correction. Neither
scene includes the human-approved leaf-color and moss source: both use provisional
older plants and cannot be called an integrated paving patch.

## Actual results

| Source | Stones | Longest internal grid seam | Visible outcome |
| --- | ---: | ---: | --- |
| [Earlier patch](patch/candidate2/top-packing.png) | 131 | 28/28 cells | Full-field lane-like joints; three mineral identities repeat |
| [Mixed layout candidate1](layout-study/candidate1/top-packing.png) | 111 | 16/28 cells | More T-junctions, still long registered runs and small-paver cadence |
| [Continuous warp candidate2](layout-study/candidate2/top-packing.png) | 111 | 16/28 cells | Gently bent edges; topology, long connected joints and repetition persist |

Candidate1's deterministic [layout](layout-study/layout2.json) uses 14 square,
24 medium and 73 long placements across five proportions. The first 300 random
preflight candidates reached a 20-cell seam; a bounded local-flip search reached
16. The [native source](layout-study/candidate1/source.blend) and
[sunny](layout-study/candidate1/sunny-oblique.png),
[opposing](layout-study/candidate1/opposing-light.png),
[overcast](layout-study/candidate1/overcast.png),
[walking](layout-study/candidate1/walking.png), and top captures were inspected by
lead and both independent [quality](quality-layout1.md) and
[theme](theme-layout1.md) reviewers. The scene has 547,740 triangles, including
432,900 in stones and 112,072 in ground; ground remains above the 8,192 production
target. Conservative stone AABBs have no overlaps and at least 10.01 mm clearance.
The 111 stones remain within the 200-placement source ceiling. The same three
mineral surfaces create conspicuous repeated pale landmarks.

Candidate2 maps every mesh vertex, including soil and provisional plants, through
one continuous XY warp. The [gray top](layout-study/candidate2/top-packing-gray.png),
[walking](layout-study/candidate2/walking.png), sunny, opposing and overcast views
were inspected by lead and both independent [quality](quality-layout2.md) and
[theme](theme-layout2.md) reviewers. It gently softens the outlines without an
obvious new contact or lighting artifact, but coordinated waves remain visible and
the long joint paths stay connected. The analytic displacement Lipschitz upper
bound is 0.2091, giving at least 7.92 mm separation from candidate1's conservative
10.01 mm bound. This is a mathematical lower bound, not a measured triangle-pair
minimum. Materials and triangle count remain unchanged. Global warp does not
change topology or create new material identities; stop this technique here.

Both candidates' recorded file sizes and SHA-256 hashes were independently
rechecked (eight files each); candidate2's source hash matches candidate1's saved
Blend file. The two native builds used isolated Blender 5.2.1 processes. No engine
import, compression, LOD, full QA, rights review or production performance result
was obtained. Physical smoke remains deferred to M4.5 exit.

## Next method

Use candidate1's layout only as an initial contact-safe starting point. A new
bounded source family/adjacency package must replace the long registered runs with
different neighbor relationships and less uniform slab proportions, then add
distinct broad mineral identities within the eight-variant paving class. Import the
human-approved leaf color and moss into the selected layout, rechecking rooted
support and stone clearance, before asking for integrated artistic acceptance.
Do not use a texture offset or global surface warp as evidence that the repeated
landmarks are solved. Production ground/foliage reduction and installed-game proof
remain subsequent gates.
